const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Health check for Railway
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Poll state
let currentQuestion = null;
let currentOptions = [];
let currentTimer = 60;
let answers = {};
let pollTimeout = null;
let connectedStudents = new Map(); // Map of socket.id -> student info
let chatMessages = []; // Store chat messages
let pastPolls = []; // Store past poll results

const endPoll = () => {
  console.log('endPoll called, currentQuestion:', currentQuestion);
  if (currentQuestion) {
    console.log('Poll timer ended for:', currentQuestion);
    
    // Store poll result in history before clearing
    const pollResult = {
      id: Date.now(),
      question: currentQuestion,
      options: currentOptions,
      answers: Object.values(answers),
      endedAt: new Date(),
      totalResponses: Object.values(answers).length
    };
    pastPolls.unshift(pollResult); // Add to beginning of array (most recent first)
    
    // Keep only last 50 polls to prevent memory issues
    if (pastPolls.length > 50) {
      pastPolls = pastPolls.slice(0, 50);
    }
    
    console.log('Poll result stored in history:', pollResult.question);
    
    io.emit('poll-ended', {
      question: currentQuestion,
      options: currentOptions,
      finalAnswers: Object.values(answers)
    });

    currentQuestion = null;
    currentOptions = [];
    currentTimer = 60;
    answers = {};
    if (pollTimeout) {
      clearTimeout(pollTimeout);
      pollTimeout = null;
    }
    console.log('Poll state cleared');
  }
};

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    try {
        if (currentQuestion) {
          socket.emit('new-question', {
            question: currentQuestion,
            options: currentOptions,
            timer: currentTimer
          });
          console.log('📤 Sent current question to newly connected user:', socket.id);
        }
    } catch (error) {
        console.error('❌ Error sending current question:', error);
    }

    // Listen for student name registration
    socket.on('register-student', (data) => {
        connectedStudents.set(socket.id, {
            name: data.name,
            socketId: socket.id,
            joinedAt: new Date()
        });
        
        console.log(`Student registered: ${data.name}, total students: ${connectedStudents.size}`);
        console.log('Current students:', Array.from(connectedStudents.values()));
        
        // Broadcast updated student list to teachers
        io.emit('students-updated', Array.from(connectedStudents.values()));
        console.log('Emitted students-updated event');
    });

    // Handle kick student
    socket.on('kick-student', (data) => {
        const targetSocketId = data.socketId;
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        
        if (targetSocket) {
            // Remove from answers if they had answered
            delete answers[targetSocketId];
            
            // Remove from connected students
            connectedStudents.delete(targetSocketId);
            
            // Notify the kicked student (no message needed, just the event)
            targetSocket.emit('kicked-out');
            
            // Update student list for teachers
            io.emit('students-updated', Array.from(connectedStudents.values()));
            
            console.log(`Student kicked: ${targetSocketId}`);
        }
    });

    // Handle request for current student list
    socket.on('request-student-list', () => {
        console.log('Teacher requested student list, sending current students:', Array.from(connectedStudents.values()));
        socket.emit('students-updated', Array.from(connectedStudents.values()));
    });

    // Chat functionality
    socket.on('send-chat-message', (data) => {
        const message = {
            id: Date.now(),
            sender: data.sender,
            senderType: data.senderType, // 'teacher' or 'student'
            message: data.message,
            timestamp: new Date()
        };
        
        chatMessages.push(message);
        
        // Broadcast message to all connected users
        io.emit('chat-message-received', message);
        console.log(`Chat message from ${data.sender} (${data.senderType}): ${data.message}`);
    });

    socket.on('request-chat-history', () => {
        socket.emit('chat-history', chatMessages);
    });

    // Past polls functionality
    socket.on('request-past-polls', () => {
        console.log('Teacher requested past polls, sending:', pastPolls.length, 'polls');
        socket.emit('past-polls-history', pastPolls);
    });

    socket.on('create-question', (data) => {
        console.log('create-question event received:', data);
        console.log('Current state before update:', { currentQuestion, currentOptions, currentTimer });
        
        // Clear any existing poll results first
        io.emit('clear-results');
        console.log('Emitted clear-results to all clients');
        
        // Allow new question creation regardless of current state
        currentQuestion = data.question;
        currentOptions = data.options || [];
        currentTimer = data.timer || 60;
        answers = {};

        if (pollTimeout) {
          console.log('Clearing existing poll timeout');
          clearTimeout(pollTimeout);
        }
        pollTimeout = setTimeout(endPoll, currentTimer * 1000);

        console.log('About to emit new-question:', {
            question: currentQuestion,
            options: currentOptions,
            timer: currentTimer
        });
        
        io.emit('new-question', {
            question: currentQuestion,
            options: currentOptions,
            timer: currentTimer
        });
        console.log('New question broadcasted:', currentQuestion);
        console.log('Connected clients:', io.engine.clientsCount);
        
        // Test broadcast - emit a simple test event too
        io.emit('test-broadcast', { message: 'Test from server', timestamp: Date.now() });
    });

    socket.on('reset-poll', () => {
        console.log('Poll reset requested');
        
        // Store current poll in history before resetting if it exists
        if (currentQuestion) {
            const pollResult = {
                id: Date.now(),
                question: currentQuestion,
                options: currentOptions,
                answers: Object.values(answers),
                endedAt: new Date(),
                totalResponses: Object.values(answers).length,
                manuallyEnded: true
            };
            pastPolls.unshift(pollResult);
            
            if (pastPolls.length > 50) {
                pastPolls = pastPolls.slice(0, 50);
            }
            
            console.log('Poll manually ended and stored in history:', pollResult.question);
        }
        
        currentQuestion = null;
        currentOptions = [];
        currentTimer = 60;
        answers = {};
        if (pollTimeout) {
            clearTimeout(pollTimeout);
            pollTimeout = null;
        }
        // Notify all clients that poll was reset
        io.emit('poll-reset');
    });

    socket.on('submit-answer', (data) => {
    if (!currentQuestion) {
      socket.emit('submission-error', { message: 'No active poll to submit an answer to.' });
      return;
    }
    if (answers[socket.id]) {
      socket.emit('submission-error', { message: 'You have already submitted an answer for this poll.' });
      return;
    }
    answers[socket.id] = data.answer;
    
    // Emit results with all required data
    console.log('Emitting poll-results:', {
        question: currentQuestion,
        options: currentOptions,
        answers: Object.values(answers)
    });
    io.emit('poll-results', {
        question: currentQuestion,
        options: currentOptions,
        answers: Object.values(answers)
    });
});
    

    socket.on('disconnect', () => {
        delete answers[socket.id];
        connectedStudents.delete(socket.id);
        console.log('User disconnected:', socket.id);
        
        // Update student list for teachers
        io.emit('students-updated', Array.from(connectedStudents.values()));
        
        if (currentQuestion) {
            io.emit('poll-results', {
                question: currentQuestion,
                options: currentOptions,
                answers: Object.values(answers)
            });
        }
    });
});

// Start server
server.listen(PORT, HOST, () => {
    console.log(`✅ Server running on ${HOST}:${PORT}`);
    console.log(`✅ Socket.IO ready`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = server;
