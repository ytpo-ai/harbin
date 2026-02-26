export interface EmployeeJwtPayload {
    employeeId: string;
    email?: string;
    organizationId?: string;
    exp: number;
}
export declare function verifyEmployeeToken(token: string, secret: string): EmployeeJwtPayload | null;
