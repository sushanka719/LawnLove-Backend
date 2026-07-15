import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PhotoType } from '../../../generated/prisma/client';

export class RegisterPhotoDto {
  @IsEnum(PhotoType)
  type: PhotoType;

  // The object key returned by /photos/upload-url. Validated server-side to be
  // under this job's namespace before a JobPhoto row is created.
  @IsString()
  key: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsDateString()
  takenAt: string;
}
