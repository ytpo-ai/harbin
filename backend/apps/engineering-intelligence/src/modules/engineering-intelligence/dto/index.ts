import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateEngineeringRepositoryDto {
  @IsString()
  @Matches(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i, {
    message: 'repositoryUrl must be a valid GitHub repository URL',
  })
  repositoryUrl: string;

  @IsOptional()
  @IsString()
  branch?: string;
}

export class UpdateEngineeringRepositoryDto {
  @IsOptional()
  @IsString()
  branch?: string;
}
