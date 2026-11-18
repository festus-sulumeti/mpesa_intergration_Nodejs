export interface AgentEval {
  name: string;
  message: string;
  phone?: string;
  amount?: number;
  accountReference?: string;
  resultCode?: number;
  needsConfirmation?: boolean;
  intent: "stk" | "explain";
}

export const agentEvals: AgentEval[] = [
  {
    name: "swahili mia tano",
    message: "Nitumie stk ya mia tano kwa 0712345678",
    phone: "254712345678",
    amount: 500,
    accountReference: "MPESA",
    needsConfirmation: true,
    intent: "stk",
  },
  {
    name: "english chama",
    message: "prompt 0712345678 for KES 500 for January chama",
    phone: "254712345678",
    amount: 500,
    accountReference: "JANUARYCHAMA",
    needsConfirmation: true,
    intent: "stk",
  },
  {
    name: "school fees",
    message: "Send 200 to 254711111111 for school fees",
    phone: "254711111111",
    amount: 200,
    accountReference: "SCHOOLFEES",
    needsConfirmation: true,
    intent: "stk",
  },
  {
    name: "cancelled result code",
    message: "what does result code 1032 mean",
    resultCode: 1032,
    intent: "explain",
  },
  {
    name: "swahili result code",
    message: "maana ya code 1037",
    resultCode: 1037,
    intent: "explain",
  },
];
