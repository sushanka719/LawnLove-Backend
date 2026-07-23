import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

// The agent's offered-services catalog (display/marketing only — bookings run
// through Plans). Every row is scoped to `agentId`; same ownership idiom as
// EmployeesService.
@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(agentId: string) {
    return this.prisma.service.findMany({
      where: { agentId },
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        unit: true,
        active: true,
        sortOrder: true,
        createdAt: true,
      },
    });
  }

  create(agentId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        agentId,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        unit: dto.unit ?? undefined, // let the schema default ("per visit") apply
        active: dto.active ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
  }

  async update(agentId: string, id: string, dto: UpdateServiceDto) {
    await this.assertOwned(agentId, id);

    const data: Prisma.ServiceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.service.update({ where: { id }, data });
  }

  async remove(agentId: string, id: string) {
    await this.assertOwned(agentId, id);
    await this.prisma.service.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwned(agentId: string, id: string) {
    const existing = await this.prisma.service.findFirst({
      where: { id, agentId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Service not found.');
    }
    return existing;
  }
}
