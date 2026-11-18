import express from "express";
import { stkPushing, tokenCreation } from "../darajaspace/token";

const routing = express.Router();

routing.post("/", tokenCreation, stkPushing);

export default routing;
