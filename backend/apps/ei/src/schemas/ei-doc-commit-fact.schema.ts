import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiDocCommitFactDocument = EiDocCommitFact & Document;

@Schema({ timestamps: true, collection: 'ei_doc_commit_facts' })
export class EiDocCommitFact {
  @Prop({ required: true })
  commitSha: string;

  @Prop({ required: true })
  docPath: string;

  @Prop({ required: true, type: Date })
  committedAt: Date;

  @Prop()
  author?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiDocCommitFactSchema = SchemaFactory.createForClass(EiDocCommitFact);

EiDocCommitFactSchema.index({ commitSha: 1, docPath: 1 }, { unique: true });
EiDocCommitFactSchema.index({ committedAt: -1 });
