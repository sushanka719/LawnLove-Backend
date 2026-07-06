-- AlterTable
ALTER TABLE "user" ADD COLUMN     "displayUsername" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

