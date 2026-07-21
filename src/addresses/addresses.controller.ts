import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

type AuthSession = typeof auth.$Infer.Session;

// Saved-address book for the signed-in customer. The global AuthGuard protects
// every route, so `session.user` is always present here.
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@Session() session: AuthSession) {
    return this.addresses.list(session.user.id);
  }

  @Post()
  create(@Session() session: AuthSession, @Body() dto: CreateAddressDto) {
    return this.addresses.create(session.user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(session.user.id, id, dto);
  }

  @Post(':id/default')
  setDefault(@Param('id') id: string, @Session() session: AuthSession) {
    return this.addresses.setDefault(session.user.id, id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: AuthSession) {
    return this.addresses.remove(session.user.id, id);
  }
}
