import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { JobsService } from './jobs.service';
import { StartJobDto } from './dto/start-job.dto';
import { PhotoUploadUrlDto } from './dto/photo-upload-url.dto';
import { RegisterPhotoDto } from './dto/register-photo.dto';

type AuthSession = typeof auth.$Infer.Session;

@Roles(['agent'])
@Controller('agent/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  listJobs(
    @Session() session: AuthSession,
    @Query('unassigned') unassigned?: string,
  ) {
    return this.jobsService.listMyJobs(session.user.id, unassigned === 'true');
  }

  @Get(':id')
  getJob(@Param('id') id: string, @Session() session: AuthSession) {
    return this.jobsService.getJobDetail(id, session.user.id);
  }

  @Post(':id/start')
  start(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: StartJobDto,
  ) {
    return this.jobsService.startJob(id, session.user.id, dto);
  }

  @Post(':id/photos/upload-url')
  createUploadUrl(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: PhotoUploadUrlDto,
  ) {
    return this.jobsService.createUploadUrl(id, session.user.id, dto);
  }

  @Post(':id/photos')
  registerPhoto(
    @Param('id') id: string,
    @Session() session: AuthSession,
    @Body() dto: RegisterPhotoDto,
  ) {
    return this.jobsService.registerPhoto(id, session.user.id, dto);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Session() session: AuthSession) {
    return this.jobsService.completeJob(id, session.user.id);
  }
}
