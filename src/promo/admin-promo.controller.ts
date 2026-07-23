import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { PromoService } from './promo.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';

// Admin promo-code management (role=admin).
@Roles(['admin'])
@Controller('admin/promos')
export class AdminPromoController {
  constructor(private readonly promo: PromoService) {}

  @Get()
  list() {
    return this.promo.listAll();
  }

  @Post()
  create(@Body() dto: CreatePromoDto) {
    return this.promo.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    return this.promo.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promo.remove(id);
  }
}
