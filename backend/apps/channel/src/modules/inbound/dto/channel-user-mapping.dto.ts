import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateChannelUserMappingDto {
  @IsIn(['feishu-app'])
  providerType: 'feishu-app';

  @IsString()
  @IsNotEmpty()
  externalUserId: string;

  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsOptional()
  displayName?: string;
}

export class BindChannelUserByEmailDto {
  @IsIn(['feishu-app'])
  providerType: 'feishu-app';

  @IsString()
  @IsNotEmpty()
  externalUserId: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  displayName?: string;
}
