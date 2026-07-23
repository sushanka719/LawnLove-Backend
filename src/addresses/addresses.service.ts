import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  // Default-first, then newest — matches how the dashboard renders the list.
  list(userId: string) {
    return this.prisma.savedAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: CreateAddressDto) {
    // A user's first saved address is always their default; after that it's
    // opt-in via `isDefault`.
    const count = await this.prisma.savedAddress.count({ where: { userId } });
    const makeDefault = count === 0 || dto.isDefault === true;

    const data: Prisma.SavedAddressUncheckedCreateInput = {
      userId,
      address: dto.address,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      isDefault: makeDefault,
    };

    if (!makeDefault) {
      return this.prisma.savedAddress.create({ data });
    }

    // Promote atomically: clear the previous default, then create this one.
    const [, created] = await this.prisma.$transaction([
      this.prisma.savedAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.savedAddress.create({ data }),
    ]);
    return created;
  }

  // Called when a booking's payment succeeds: persist the address the customer
  // just booked with into their reusable address book so they can pick it next
  // time. Idempotent — if they already have a saved address with the same text
  // (they picked an existing one, or re-booked the same place), it's a no-op, so
  // completing repeat bookings never spawns duplicates. Reuses `create`, so the
  // user's first-ever saved address still becomes their default.
  async saveFromBooking(
    userId: string,
    input: { address: string; lat: number | null; lng: number | null },
  ) {
    const address = input.address.trim();
    if (!address) return null;

    const existing = await this.prisma.savedAddress.findFirst({
      where: { userId, address: { equals: address, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing;

    return this.create(userId, {
      address,
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    await this.assertOwned(userId, id);

    const data: Prisma.SavedAddressUpdateInput = {};
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;

    // Flipping to default demotes the current default in the same transaction.
    // We never act on `isDefault: false` here — the single-default invariant is
    // maintained through create/setDefault/remove, not by unsetting in place.
    if (dto.isDefault === true) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.savedAddress.updateMany({
          where: { userId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        }),
        this.prisma.savedAddress.update({
          where: { id },
          data: { ...data, isDefault: true },
        }),
      ]);
      return updated;
    }

    return this.prisma.savedAddress.update({ where: { id }, data });
  }

  async setDefault(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.$transaction([
      this.prisma.savedAddress.updateMany({
        where: { userId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      }),
      this.prisma.savedAddress.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    return { success: true };
  }

  async remove(userId: string, id: string) {
    const existing = await this.assertOwned(userId, id);
    await this.prisma.savedAddress.delete({ where: { id } });

    // Don't leave a user with zero defaults: promote the most recent survivor.
    if (existing.isDefault) {
      const next = await this.prisma.savedAddress.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.savedAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { success: true };
  }

  // Scoping by `userId` means a missing OR unowned row both 404 — we never
  // reveal another user's data (same idiom as booking.service.ts).
  private async assertOwned(userId: string, id: string) {
    const existing = await this.prisma.savedAddress.findFirst({
      where: { id, userId },
      select: { id: true, isDefault: true },
    });
    if (!existing) {
      throw new NotFoundException('Saved address not found.');
    }
    return existing;
  }
}
