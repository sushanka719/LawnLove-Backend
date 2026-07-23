import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

type AuthSession = typeof auth.$Infer.Session;

// Agent-facing service catalog (role=agent). Scoped to `agentId = session.user.id`.
@Roles(['agent'])
@Controller('agent/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@Session() session: AuthSession) {
    return this.services.list(session.user.id);
  }

  @Post()
  create(@Session() session: AuthSession, @Body() dto: CreateServiceDto) {
    return this.services.create(session.user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(session.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: AuthSession) {
    return this.services.remove(session.user.id, id);
  }
}
