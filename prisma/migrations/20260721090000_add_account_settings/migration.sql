-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3),
ADD COLUMN     "emailReminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "promotionalEmails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smsOnTheWayAlerts" BOOLEAN NOT NULL DEFAULT false;
