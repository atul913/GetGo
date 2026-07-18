// models/chatHistoryModel.js
const mongoose = require("mongoose");

const MessageDataSchema = new mongoose.Schema({
    content: {
        type: String,
        default: ""
    }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ["human", "ai"]
    },
    data: MessageDataSchema
}, { _id: false });

const ChatHistorySchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    messages: [MessageSchema]
}, { timestamps: true, collection: "chat_histories" });

module.exports = mongoose.model("ChatHistory", ChatHistorySchema);
