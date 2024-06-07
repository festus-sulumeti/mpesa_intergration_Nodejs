const express = require("express");
const app = express();
const TokenRouting  = require("./routing/token");

app.use(express.json());


app.listen(5001, () => {
    console.log("Tunaunda an mpesa Api ya backend");
});

app.get("/", (req, res) => {
    res.send("Hey karibu mpesa Kenya API Huku backend");
});

app.use("/token", TokenRouting);
