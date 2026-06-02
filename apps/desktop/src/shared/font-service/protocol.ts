export type FontServiceRequest = {
  id: string;
  type: "ping";
};

export type FontServiceResponse =
  | {
      id: string;
      type: "pong";
    }
  | {
      id: string;
      type: "error";
      message: string;
    };

export type FontServiceEvent = {
  type: "ready";
};

export type FontServiceMessage = FontServiceResponse | FontServiceEvent;
