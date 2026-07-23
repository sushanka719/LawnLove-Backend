import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfUtcDay } from '../scheduler/scheduling.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  // Active first, then newest — matches how the dashboard renders the cards.
  // `_count.jobs` powers the "N visits" badge on each card.
  async list(agentId: string) {
    const rows = await this.prisma.employee.findMany({
      where: { agentId },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { jobs: true } } },
    });
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      email: e.email,
      dailyCap: e.dailyCap,
      active: e.active,
      createdAt: e.createdAt,
      jobsCount: e._count.jobs,
    }));
  }

  create(agentId: string, dto: CreateEmployeeDto) {
    return this.prisma.employee.create({
      data: {
        agentId,
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        dailyCap: dto.dailyCap ?? undefined, // let the schema default (5) apply
        active: dto.active ?? undefined,
      },
    });
  }

  async update(agentId: string, id: string, dto: UpdateEmployeeDto) {
    await this.assertOwned(agentId, id);

    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.dailyCap !== undefined) data.dailyCap = dto.dailyCap;
    if (dto.active !== undefined) data.active = dto.active;

    const updated = await this.prisma.employee.update({
      where: { id },
      data,
    });

    // Deactivating frees this employee's upcoming visits so the next cron pass
    // re-picks them among whoever is still active.
    if (dto.active === false) {
      await this.releaseFutureJobs(id);
    }
    return updated;
  }

  // Soft delete: deactivate rather than hard-delete so historical Jobs keep
  // their employee reference (and its name still shows on past visits).
  async remove(agentId: string, id: string) {
    await this.assertOwned(agentId, id);
    await this.prisma.employee.update({
      where: { id },
      data: { active: false },
    });
    await this.releaseFutureJobs(id);
    return { success: true };
  }

  // Unassign this employee from their still-upcoming, not-yet-started visits.
  // Completed/in-progress visits are left untouched — the work (or its record)
  // stands. `scheduledDate >= today` guards against re-opening past visits.
  private releaseFutureJobs(employeeId: string) {
    return this.prisma.job.updateMany({
      where: {
        employeeId,
        status: 'assigned',
        scheduledDate: { gte: startOfUtcDay(new Date()) },
      },
      data: { employeeId: null },
    });
  }

  // Scoping by `agentId` means a missing OR another agent's employee both 404 —
  // same ownership idiom as the rest of the app.
  private async assertOwned(agentId: string, id: string) {
    const existing = await this.prisma.employee.findFirst({
      where: { id, agentId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Employee not found.');
    }
    return existing;
  }
}
