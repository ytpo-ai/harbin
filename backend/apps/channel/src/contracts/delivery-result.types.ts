export interface DeliveryResult {
  success: boolean;
  providerType: string;
  statusCode?: number;
  errorMessage?: string;
  deliveredAt: Date;
}
