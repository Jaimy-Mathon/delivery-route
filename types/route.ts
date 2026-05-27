export type AddressStop = {
  id: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  raw: string;
  delivered: boolean;
};

export type EditableAddress = Omit<AddressStop, "id" | "delivered">;