const express = require("express");
const mongoose = require("mongoose");
const Chatroom = require("./models/Chatroom");
const Message = require("./models/Message");
const http = require("http");
const socketIo = require("socket.io");
const chatroomCleanup = require("./chatroomCleanup");
const serializationUtils = require("./serializationUtils");

const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require("cors");
const axios = require("axios");

//Variable to store socket ID mappings
const publicKeyToSocketIdMap = {};

// chatroom message index counter
const chatroomIndices = {};
const id = 4001;
var leader=0;
const app = express();

const otherServers = ["http://localhost:4000", "http://localhost:4002"];
const pid =2;
//Remove cors
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const response = axios.post(`${otherServers[1]}/election`, {
    id: id
}).then(response => {
  console.log(response);
})
.catch((error) => {
console.error(`Failed to send message to server: ${server}`, error);
leader = id;
const response = axios.post(`${otherServers[0]}/leader`, {
    leader: id
}).catch((error) => {
    console.error(`Failed to send message to server: ${server}`, error);
});
});
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3006"], // Allow only the React client to connect
    methods: ["GET", "POST"], // Allow only these methods in CORS requests
  },
});

io.on("connection", (socket) => {
  console.log("Client connected");
  if(leader!=id){
    const response = axios.post(`${otherServers[1]}/election`, {
        id: id
    }).then(response => {
      console.log(response);
      socket.disconnect();
  })
  .catch((error) => {
    console.error(`Failed to send message to server: ${server}`, error);
    leader = id;
    const response = axios.post(`${otherServers[0]}/leader`, {
        leader: id
    });
  });
}
  socket.on("ping", () => {
    console.log("Received ping from client. Sending pong...");
    socket.emit("pong");
  });

  socket.on("disconnect", (reason) => {
    console.log(`Client disconnected, reason: ${reason}`);
  });

  socket.on("register_public_key", (info) => {
    console.log(info.publicKey);
    publicKeyToSocketIdMap[info.publicKey] = socket.id;
    Chatroom.findOne({ Password: info.chatroom }).then((result) => {
      if (result) {
        result.UserPubKeys.forEach((key) => {
          console.log(key);
          const recipientSocketId = publicKeyToSocketIdMap[key];
          if (recipientSocketId) {
            // Use Socket.IO to send the message to the recipient's socket
            io.to(recipientSocketId).emit("new_public_keys", {
              publicKeys: result.UserPubKeys,
            });
          } else {
            console.log(publicKeyToSocketIdMap);
            console.log(`Recipient with public key ${key} not connected.`);
          }
        });
      } else {
        console.log("No result");
      }
    });
  });

  socket.on("error", (error) => {
    console.error(`Connection error: ${error}`);
  });
});

const uri =
  "mongodb+srv://Connection:JzzfUSLoOVwLlFYF@database2.iogjxyr.mongodb.net/?retryWrites=true&w=majority&appName=Database2";

mongoose.connect(uri).then((result) => console.log("connected to db"));
const port = process.env.PORT || 4001;
server.listen(port, () => console.log(`Listening on port ${port}`));

chatroomCleanup();

const generateColor = (publicKey) => {
  // Calculate a hash code to create a color from the public key
  const hashCode = publicKey.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);

  const hue = hashCode % 360;

  return `hsl(${hue}, 70%, 86%)`;
};

app.post("/election",  async (req, res) => {
  mid = req.body.id 
  if (mid<id)
  {
   res.send("Ok");
  }
  else{
    console.log(id)
    console.log(mid);
    io.disconnectSockets();
  }
});

app.post("/leader",  async (req, res) => {
  lead = req.body.leader 
  leader= lead;
  io.disconnectSockets();
});


//Example for how to call the following endpoint http://localhost:4000/chatrooms
//Endpoint can be used to get all chatrooms
app.get("/chatrooms", async (req, res) => {
  Chatroom.find({})
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.log(err);
    });
});

//Example for how to call the following endpoint http://localhost:4000/messages
//Endpoint can be used to get all messages
app.get("/messages", async (req, res) => {
  Message.find({})
    .then((result) => {
      res.send(result);
    })
    .catch((err) => {
      console.log(err);
    });
});

//Example for how to call the following endpoint http://localhost:4000/chatroom/65d691acb3615c49d737f639/messages
//Endpoint can be used to get all messages for a specific chatroom
app.get("/chatroom/:id/messages", async (req, res) => {
  try {
    const messages = await Message.find({ ChatroomID: req.params.id });
    res.status(200).json(messages);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

//Example for how to call the following endpoint http://localhost:4000/message?message=Content&user=Test User&chatroom=65d691acb3615c49d737f639
//Endpoint can be used to send new message data to the db
app.post("/message", async (req, res) => {
  console.log(req.body);
  try {
    const serializedEncryptedMessage = req.body.cipher;
    const serializedRecipients = req.body.recipients;
    const senderBase64PublicKey = req.body.senderBase64PublicKey
    const clientColor = generateColor(senderBase64PublicKey);

    const message = await Message.create({
      Cipher: serializedEncryptedMessage,
      // sender should be inferred through socket, what happens if sender pretends to be someone else?
      Sender: senderBase64PublicKey,
      ChatroomID: req.body.currChatroom,
      MessageIndex: chatroomIndices[req.body.currChatroom]
    });

    //If the message came from the client, lets forward the message to each other server
    if (req.body?.fromClient) {
      otherServers.forEach((server) => {
        axios
          .post(`${server}/message`, {
            cipher: serializedEncryptedMessage,
            recipients: serializedRecipients,
            senderBase64PublicKey: senderBase64PublicKey,
            currChatroom: req.body.currChatroom,
          })
          .then((response) => {
            console.log(`Sent message to server ${server} successfully.`);
          })
          .catch((error) => {
            console.error(`Failed to send message to server: ${server}`, error);
          });
      });
    }

    const recipients =
      serializationUtils.deserializeUint8ArrayObject(serializedRecipients);

    Object.entries(recipients).forEach(([publicKey, encryptedSymmetricKey]) => {
      const serializedEncryptedSymmetricKey =
        serializationUtils.serializeUint8ArrayObject(encryptedSymmetricKey);
      const recipientSocketId = publicKeyToSocketIdMap[publicKey];
      if (recipientSocketId) {
        // Use Socket.IO to send the message to the recipient's socket
        io.to(recipientSocketId).emit("new_message", {
          serializedEncryptedMessage,
          serializedEncryptedSymmetricKey,
          clientColor: clientColor,
          messageIndex: chatroomIndices[req.body.currChatroom]
        });
      } else {
        console.log(publicKeyToSocketIdMap);
        console.log(`Recipient with public key ${publicKey} not connected.`);
      }
    });
    console.log("Made message");
    
    chatroomIndices[req.body.currChatroom] += 1;

    //loop across the recipients and broadcast the message to each of them with the appropriate symmetric key
    res.status(200).json(message);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
});

//Example for how to call the following endpoint http://localhost:4000/chatroom?password=coool
//Endpoint can be used to create a new chatroom and send data to the db
app.post("/chatroom", async (req, res) => {
  console.log(req.body);
  try {
    const chatroom = await Chatroom.create({
      Password: req.body.password,
      UserPubKeys: [req.body.userPubKey],
    });

    //If the message came from the client, lets forward the message to each other server
    if (req.body?.fromClient) {
      otherServers.forEach((server) => {
        axios
          .post(`${server}/chatroom`, {
            password: req.body.password,
            userPubKey: req.body.userPubKey,
          })
          .then((response) => {
            console.log(`Sent chatroom to server ${server} successfully.`);
          })
          .catch((error) => {
            console.error(
              `Failed to send chatroom to server ${server}:`,
              error
            );
          });
      });
    }

    chatroomIndices[req.body.password] = 0;
    
    res.status(200).json(chatroom);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

//Example of how to call the following endpoint http://localhost:4000/room?password=coool390
//This endpoint can be called to login a user it will take a password as a parameter and either send back the chatroom id
//or send back a message stating invalid chatroom password
app.get("/room", async (req, res) => {
  const publicKey = req.query.publicKey;
  const password = req.query.Password;


  //If the message came from the client, lets forward the message to each other server
  if (req.query?.fromClient) {
    otherServers.forEach((server) => {
      axios
        .get(`${server}/room`, {
          params: {
            publicKey: req.query.publicKey,
            Password: req.query.Password,
          }
        })
        .then((response) => {
          console.log(`Sent message to server ${server} successfully.`);
        })
        .catch((error) => {
          console.error(`Failed to send message to server: ${server}`, error);
        });
    });
  }
  Chatroom.findOne({ Password: password })
    .then((chatroom) => {
      if (!chatroom) {
        return res.status(400).json({ error: "Invalid Chatroom Password" });
      }

      // Ensure publicKey is provided
      if (!publicKey) {
        return res.status(400).json({ error: "Public key is required" });
      }

      // Add the publicKey to the UserPubKeys array
      Chatroom.updateOne(
        { _id: chatroom._id },
        { $addToSet: { UserPubKeys: publicKey } }
      )
        .then((updateResult) => {
          res.status(200).json({ password: chatroom.Password });
        })
        .catch((updateError) => {
          console.error(updateError);
          res.status(500).json({ error: "Failed to add user public key" });
        });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: "An error occurred" });
    });
});