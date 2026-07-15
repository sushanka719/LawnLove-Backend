import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// Profile management for the signed-in user: avatar upload presigning (name and
// phone number go through better-auth's update-user endpoint directly).
@Module({
  imports: [StorageModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
