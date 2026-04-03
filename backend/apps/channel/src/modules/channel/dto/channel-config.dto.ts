import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';

export class FeishuConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl: string;

  @IsString()
  @IsOptional()
  webhookSecret?: string;
}

export class UpdateFeishuConfigDto {
  @IsString()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl?: string;

  @IsString()
  @IsOptional()
  webhookSecret?: string;
}

export class CreateChannelConfigDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['feishu'])
  providerType: 'feishu';

  @IsIn(['group', 'user'])
  targetType: 'group' | 'user';

  @ValidateNested()
  @Type(() => FeishuConfigDto)
  providerConfig: FeishuConfigDto;

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

  @ValidateNested()
  @Type(() => UpdateFeishuConfigDto)
  @IsOptional()
  providerConfig?: UpdateFeishuConfigDto;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  eventFilters?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
