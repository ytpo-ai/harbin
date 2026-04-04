import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateChannelConfigDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['feishu', 'feishu-app'])
  providerType: 'feishu' | 'feishu-app';

  @IsIn(['group', 'user'])
  targetType: 'group' | 'user';

  @IsObject()
  providerConfig: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eventFilters: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  createdBy?: string;
}

export class UpdateChannelConfigDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsIn(['group', 'user'])
  @IsOptional()
  targetType?: 'group' | 'user';

  @IsObject()
  @IsOptional()
  providerConfig?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  eventFilters?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
