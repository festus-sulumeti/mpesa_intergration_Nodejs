import axios from "axios";
import type { NextFunction, Request, Response } from "express";

interface DarajaOAuthResponse {
  access_token: string;
  expires_in: string;
}

interface StkPushBody {
  phone?: string;
  amount?: string | number;
}

interface StkPushRequest extends Request {
  access_token?: string;
  body: StkPushBody;
}

interface StkPushPayload {
  BusinessShortCode: number;
  Password: string;
  Timestamp: string;
  TransactionType: "CustomerPayBillOnline";
  Amount: string | number;
  PartyA: string;
  PartyB: number;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Request failed";
}

const tokenCreation = async (
  req: StkPushRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const secret_key = "place your secret key here from mpesa daraja";
  const consumer_key = "place your consumer key here from mpesa daraja";

  const auth = Buffer.from(`${consumer_key}:${secret_key}`).toString("base64");

  try {
    const response = await axios.get<DarajaOAuthResponse>(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          authorization: `Basic ${auth}`,
        },
      }
    );

    req.access_token = response.data.access_token;
    next();
  } catch (err) {
    console.log(err);
    res.status(502).json(errorMessage(err));
  }
};

const stkPushing = async (req: StkPushRequest, res: Response): Promise<void> => {
  console.log(req.body);
  if (!req.body || !req.body.phone || !req.body.amount) {
    res.status(400).json({ error: "Missing required phone number and amount" });
    return;
  }

  const phoneRegex = /^[+\d]+$/;
  if (!phoneRegex.test(req.body.phone)) {
    res.status(400).json({ error: "Invalid phone number format" });
    return;
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

  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
    "base64"
  );

  const data: StkPushPayload = {
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
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(response.data);
    res.status(201).json(response.data);
  } catch (err) {
    console.log(err);
    res.status(502).json(errorMessage(err));
  }
};

export { tokenCreation, stkPushing };
