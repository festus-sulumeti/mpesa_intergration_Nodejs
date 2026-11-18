const express = require("express");

const routing = express.Router();
const { tokenCreation, stkPushing } = require("../darajaspace/token");


routing.post("/", tokenCreation, stkPushing);

module.exports = routing;