const express = require("express");
const app = express();
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const twilio = require("twilio");
// for using turn server (to fetch tern server credential)
require("dotenv").config();

const PORT = process.env.PORT || 5002;

const server = http.createServer(app);
app.use(cors());

let connectedUsers = [];
let rooms = [];

//create route to check if room exists
app.get("/api/room-exists/:roomId", cors(), (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find((room) => room.id === roomId);
  if (room) {
    if (room.connectedUsers.length > 3) {
      return res.send({ roomExists: true, full: true });
    } else {
      return res.send({ roomExists: true, full: false });
    }
  } else {
    return res.send({ roomExists: false });
  }
});

app.get("/api/get-turn-credentials", (req, res) => {
  const accountSid = process.env.SID;
  const authToken = process.env.AUTHTOKEN;
  const client = twilio(accountSid, authToken);
  let responseToken = null;
  try {
    client.tokens.create().then((token) => {
      responseToken = token;
      // console.log(token);
      res.send({ token });
    });
  } catch (error) {
    console.log("error occured while fetching turn server credentials");
    console.log(error);
    res.send({ token: null });
  }
});

const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:3000,*",
    method: ["GET", "POST"],
  },
});
io.on("connection", (socket) => {
  console.log(`user connected ${socket.id}`);
  socket.on("create-new-room", (data) => {
    createNewRoomHandler(data, socket);
  });
  socket.on("join-room", (data) => {
    joinRoomHandler(data, socket);
  });
  socket.on("disconnect", () => {
    disconnectHandler(socket);
  });
  socket.on("conn-signal", (data) => {
    signalingHandler(data, socket);
  });
  socket.on("conn-init", (data) => {
    initializeConnectionHandler(data, socket);
  });
  socket.on("direct-message", (data) => {
    directMessageHandler(data, socket);
  });
});

//socket.io handlers
const createNewRoomHandler = (data, socket) => {
  console.log("host is creating");
  console.log(data);
  const { identity, onlyAudio } = data;
  const roomId = uuidv4();

  //create new user
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };

  //push that user to connectedUsers
  connectedUsers = [...connectedUsers, newUser];

  //create new room
  const newRoom = {
    id: roomId,
    connectedUsers: [newUser], //creating new room so only host
  };

  //join socket.io room
  socket.join(roomId);
  rooms = [...rooms, newRoom];

  //emit to that client which created that room roomId
  socket.emit("room-id", { roomId });

  //emit an event to all users connected to that room about new
  //users which are right in this room
  socket.emit("room-update", { connectedUsers: newRoom.connectedUsers });
};

const joinRoomHandler = (data, socket) => {
  const { identity, roomId, onlyAudio } = data;
  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };

  //join room as user which just is trying to join room passing room id
  const room = rooms.find((room) => room.id === roomId);
  room.connectedUsers = [...room.connectedUsers, newUser];

  // join socket.io room
  socket.join(roomId);

  //add new user to connected users array
  connectedUsers = [...connectedUsers, newUser];

  //emit to all users which are already in this room to prepare peer connection
  room.connectedUsers.forEach((user) => {
    if (user.socketId !== socket.id) {
      const data = {
        connUserSocketId: socket.id,
      };
      io.to(user.socketId).emit("conn-prepare", data);
    }
  });

  io.to(roomId).emit("room-update", { connectedUsers: room.connectedUsers });
};

const disconnectHandler = (socket) => {
  //find if user has been registered - if yes remove him from room ans connected users array
  const user = connectedUsers.find((user) => user.socketId === socket.id);
  if (user) {
    // remove user from room in server
    const room = rooms.find((room) => room.id == user.roomId);
    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );
    //leave socket io room
    socket.leave(user.roomId);

    //TODO
    //close the room if amount of users which will stay in room will be 0
    if (room.connectedUsers.length > 0) {
      // emit to all users which are still in the room that user disconnected
      io.to(room.id).emit("user-disconnected", { socketId: socket.id });

      // emit an even to all the users which are left in the room new connectedUsers in room
      io.to(room.id).emit("room-update", {
        connectedUsers: room.connectedUsers,
      });
    } else {
      rooms = rooms.filter((r) => r.id !== room.id);
    }
  }
};

const signalingHandler = (data, socket) => {
  const { connUserSocketId, signal } = data;
  const signalingData = { signal, connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-signal", signalingData);
};

//information from clients which are already in room that they have prepared for incoming connection
const initializeConnectionHandler = (data, socket) => {
  const { connUserSocketId } = data;
  const initData = { connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-init", initData);
};

const directMessageHandler = (data, socket) => {
  if (
    connectedUsers.find(
      (connUser) => connUser.socketId === data.receiverSocketId
    )
  ) {
    const receiverData = {
      authorSocketId: socket.id,
      messageContent: data.messageContent,
      isAuthor: false,
      identity: data.identity,
    };
    socket.to(data.receiverSocketId).emit("direct-message", receiverData);

    const authorData = {
      receiverSocketId: data.receiverSocketId,
      messageContent: data.messageContent,
      isAuthor: true,
      identity: data.identity,
    };
    socket.emit("direct-message", authorData);
  }
};

server.listen(PORT, () => {
  console.log(`server is listening on ${PORT} ...`);
});
