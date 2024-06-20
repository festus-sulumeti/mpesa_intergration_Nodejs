const axios = require("axios");

const tokenCreation = async (req, res, next) => {
    const secret_key = "place your secret key here from mpesa daraja";
    const consumer_key = "place your consumer key here from mpesa daraja";

    const auth = Buffer.from(`${consumer_key}:${secret_key}`).toString("base64");

    try {
        const response = await axios.get("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
            headers: {
                authorization: `Basic ${auth}`
            },
        });

        req.access_token = response.data.access_token;
        next();
    } catch (err) {
        console.log(err);
        res.status(502).json(err.message);
    }
}

const stkPushing = async (req, res) => {
    console.log(req.body);
    if (!req.body || !req.body.phone || !req.body.amount) {
        return res.status(400).json({ error: "Missing required phone number and amount" });
    }

    const phoneRegex = /^[+\d]+$/; // This regex allows only numbers and the + sign
    if (!phoneRegex.test(req.body.phone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
    }

    const token = req.access_token;
    const shortcode = 174379;
    const phonenumber = req.body.phone;
    const amount = req.body.amount;
    const passkey = "enter your pass key";

    const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

    const date = new Date();
    const timestamp = 
        date.getFullYear() + 
        ("0" + (date.getMonth() + 1)).slice(-2) +
        ("0" + date.getDate()).slice(-2) +
        ("0" + date.getHours()).slice(-2) +
        ("0" + date.getMinutes()).slice(-2) +
        ("0" + date.getSeconds()).slice(-2);

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const data = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: `254${phonenumber}`,
        PartyB: shortcode,
        PhoneNumber: `254${phonenumber}`,
        CallBackURL: "Your Call back url",
        AccountReference: "Mpesa Test",
        TransactionDesc: "Testing the push of stk push",
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        console.log(response.data);
        res.status(201).json(response.data);
    } catch (err) {
        console.log(err);
        res.status(502).json(err.message);
    }
}

module.exports = { tokenCreation, stkPushing };
