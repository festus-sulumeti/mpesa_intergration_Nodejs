import express from "express";
import tokenRouting from "./routing/token";

const app = express();

app.use(express.json());

app.listen(5001, () => {
  console.log("Tunaunda an mpesa Api ya backend");
});

app.get("/", (_req, res) => {
  res.send("Hey karibu mpesa Kenya API Huku backend");
});

app.use("/token", tokenRouting);
