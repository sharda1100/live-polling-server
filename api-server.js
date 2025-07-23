const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// Enable CORS for your frontend
app.use(cors({
    origin: [
        'https://live-polling-app-nine.vercel.app',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

// In-memory storage (for demo - use database in production)
let currentPoll = null;
let answers = [];
let students = [];

// Basic routes
app.get('/', (req, res) => {
    res.json({ message: 'Live Polling Server is running!', timestamp: new Date() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// Polling endpoints (REST API instead of Socket.IO)
app.get('/api/poll', (req, res) => {
    res.json({ 
        poll: currentPoll, 
        totalAnswers: answers.length,
        students: students.length
    });
});

app.post('/api/poll', (req, res) => {
    const { question, options, timer } = req.body;
    currentPoll = {
        id: Date.now(),
        question,
        options,
        timer,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + timer * 1000)
    };
    answers = []; // Reset answers
    console.log('New poll created:', currentPoll.question);
    res.json({ success: true, poll: currentPoll });
});

app.post('/api/answer', (req, res) => {
    const { answer, studentName } = req.body;
    
    if (!currentPoll) {
        return res.status(400).json({ error: 'No active poll' });
    }
    
    if (new Date() > new Date(currentPoll.expiresAt)) {
        return res.status(400).json({ error: 'Poll has expired' });
    }
    
    // Check if student already answered
    const existingAnswer = answers.find(a => a.studentName === studentName);
    if (existingAnswer) {
        return res.status(400).json({ error: 'You have already answered' });
    }
    
    answers.push({
        studentName,
        answer,
        timestamp: new Date()
    });
    
    console.log(`Answer received: ${studentName} -> ${answer}`);
    res.json({ success: true, totalAnswers: answers.length });
});

app.get('/api/results', (req, res) => {
    if (!currentPoll) {
        return res.json({ poll: null, answers: [] });
    }
    
    res.json({
        poll: currentPoll,
        answers: answers,
        totalAnswers: answers.length
    });
});

app.post('/api/student/register', (req, res) => {
    const { name } = req.body;
    
    if (!students.find(s => s.name === name)) {
        students.push({
            name,
            joinedAt: new Date()
        });
    }
    
    res.json({ success: true, students: students.length });
});

app.get('/api/students', (req, res) => {
    res.json({ students });
});

app.delete('/api/poll', (req, res) => {
    currentPoll = null;
    answers = [];
    res.json({ success: true });
});

// For Vercel deployment
module.exports = app;
module.exports.handler = serverless(app);
