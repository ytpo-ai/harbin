import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EngineeringIntelligenceController } from './engineering-intelligence.controller';
import { EngineeringIntelligenceService } from './engineering-intelligence.service';
import { EngineeringRepository, EngineeringRepositorySchema } from '../../schemas/engineering-repository.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EngineeringRepository.name, schema: EngineeringRepositorySchema },
    ]),
  ],
  controllers: [EngineeringIntelligenceController],
  providers: [EngineeringIntelligenceService],
})
export class EngineeringIntelligenceModule {}
