const express = require("express");

const routing = express.Router();
const { tokenCreation } = require("../darajaspace/token");


routing.post("/", tokenCreation, stkPushing);

module.exports = routing;