import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import { PromoService } from './promo.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';

// Public preview of a promo code for the booking review step. Returns whether
// the code is valid and the discount it would apply — never trusted by the
// server on POST /bookings, which recomputes the discount itself.
@Controller('promo')
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  @Public()
  @Post('validate')
  validate(@Body() dto: ValidatePromoDto) {
    return this.promo.evaluate(dto.code, dto.subtotalCents);
  }
}
