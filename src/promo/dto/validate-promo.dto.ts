import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

// Preview payload: the code plus the per-visit subtotal (CENTS) to discount.
export class ValidatePromoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @IsInt()
  @Min(0)
  subtotalCents!: number;
}
