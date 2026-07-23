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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

type AuthSession = typeof auth.$Infer.Session;

// Agent-facing employee management (role=agent). Every route is scoped to
// `agentId = session.user.id`, so an agent only ever sees/edits their own crew.
@Roles(['agent'])
@Controller('agent/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@Session() session: AuthSession) {
    return this.employees.list(session.user.id);
  }

  @Post()
  create(@Session() session: AuthSession, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(session.user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(session.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Session() session: AuthSession) {
    return this.employees.remove(session.user.id, id);
  }
}
