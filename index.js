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
const { uniqueNamesGenerator, adjectives, colors, animals } = require('unique-names-generator');

//Variable to store socket ID mappings
const publicKeyToSocketIdMap = {};

// chatroom message index counter
const chatroomIndices = {};
//Server assigned id for leader election
const id = 4001;
//Current leader id set to 0 by default
var leader=0;
const app = express();

//List of other servers to send updates to. Set to local host by default but can be updated to ip addresses to 
//run on multiple machines
const otherServers = ["http://localhost:4000", "http://localhost:4002"];

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
//Upon startup and being added to the pool of servers server 2 will check if its one larger server is online if not it will take over
//as leader of lower process server
const response = axios.post(`${otherServers[1]}/election`, {
    id: id
}).then(response => {
  console.log(response);
})
.catch((error) => {
console.error(`Failed to send message to server: ${server}`, error);
//On error means the send couldnt be completed to higher process server at this point the server can take over leader status and broadcast this message to server with lower id
leader = id;
const response = axios.post(`${otherServers[0]}/leader`, {
    leader: id
}).catch((error) => {
    console.error(`Failed to send message to server: ${server}`, error);
});
});
//Setup socket connection and allow for connections only from local network
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3006"], // Allow only the React client to connect
    methods: ["GET", "POST"], // Allow only these methods in CORS requests
  },
});
//On socket connection
io.on("connection", (socket) => {
  console.log("Client connected");
  //Send an election message to server with higher process id if there is a response socket connection should be closed and leader message will be received soon
    const response = axios.post(`${otherServers[1]}/election`, {
        id: id
    }).then(response => {
      console.log(response);
      io.disconnectSockets();
  })
  .catch((error) => {
    //If the socket send to the server with higher id failed broadcast that server 2 is now the leader to server 1
    console.error(`Failed to send message to server: ${server}`, error);
    leader = id;
    const response = axios.post(`${otherServers[0]}/leader`, {
        leader: id
    });
  });
  //Pinging is done so the client knows that the connected to server is still online if failure occurs it will move to another server
  socket.on("ping", () => {
    console.log("Received ping from client. Sending pong...");
    socket.emit("pong");
  });
  //Console log any socket disconnects this was used for debugging purposes no specific disconnect behavior
  socket.on("disconnect", (reason) => {
    console.log(`Client disconnected, reason: ${reason}`);
  });
  //Register public key is a way for the client to send a newly registered socket connection to all other clients for the purpose of encryption
  socket.on("register_public_key", (info) => {
    console.log(info.publicKey);
    //The ppublic key information will be registered to the servers local list and then the server will query the database and emit the newly added
    //public key to all other clients currently in the chatroom this is done so that they can generate their encrypted messages with the new user in mind
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
  //On socket error console log error message
  socket.on("error", (error) => {
    console.error(`Connection error: ${error}`);
  });
});

//Uri is used to connect to server two database in mongodb 
const uri =
  "mongodb+srv://Connection:JzzfUSLoOVwLlFYF@database2.iogjxyr.mongodb.net/?retryWrites=true&w=majority&appName=Database2";
//Connect to the mongodb instance then start listening on port 4001
mongoose.connect(uri).then((result) => console.log("connected to db"));
const port = process.env.PORT || 4001;
server.listen(port, () => console.log(`Listening on port ${port}`));
//Call chatroom cleanup message to remove any unneeded chatrooms
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

function generateIndexFromHash(hash, dictionarySize) {
  // Taking a slice of the hash to get a smaller number and converting it to an integer
  if(hash < 0) {
    hash = hash * -1;
  }
  // Using modulo to ensure the index fits within the dictionary size
  return hash % dictionarySize;
}
//GenerateUserName function is used to create a unique anonymous username 
//from the users defined public key (Note this is not an entirely unique name that is generated
//and has something like a 1 in 42000 chance to match but that is very unlikely so has been left with those odds for this project)
const generateUserName = (publicKey) => {
  const hashCode = publicKey.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  const adjectiveIndex = generateIndexFromHash(hashCode, adjectives.length);
  const animalIndex = generateIndexFromHash(hashCode, animals.length);

  const adjective = adjectives[adjectiveIndex];
  const animal = animals[animalIndex];

  // Combine and format the words to form the username
  return `${adjective.charAt(0).toUpperCase() + adjective.slice(1)}${animal.charAt(0).toUpperCase() + animal.slice(1)}`;
}

//Election endpoint if this is called it will be from lower process id server and as such it should broadcast the leader message if it is in fact coming from the lower server
//if the election does have a higher process id however the server should disconnect all socket connections to allow for the new soon to be leader to receive client connections
app.post("/election",  async (req, res) => {
  mid = req.body.id 
  if (mid<id)
  {
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
   res.send("Ok");
  }
  else{
    console.log(id)
    console.log(mid);
    io.disconnectSockets();
  }
});
//Leader endpoint that should set the new leader locally to server 2 and disconnect all socket connections for new leader
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
    const userName = generateUserName(senderBase64PublicKey);

    const message = await Message.create({
      Cipher: serializedEncryptedMessage,
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
          userName: userName,
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