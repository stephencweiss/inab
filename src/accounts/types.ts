type AccountIdentity = {
  readonly id: string;
  readonly name: string;
  readonly currency: "USD";
};

export type RegisterAccount = AccountIdentity & {
  readonly kind: "cash" | "credit";
  readonly openingCents: number;
  readonly openingDate: string;
};

export type TrackingAccount = AccountIdentity & {
  readonly kind: "tracking";
  readonly openingCents: null;
  readonly openingDate: null;
};

export type Account = RegisterAccount | TrackingAccount;
export type NewAccount = Omit<RegisterAccount, "id"> | Omit<TrackingAccount, "id">;

export type RegisterEntry = {
  readonly id: string;
  readonly accountId: string;
  readonly cents: number;
  readonly occurredOn: string;
  readonly postedOn: string | null;
};
