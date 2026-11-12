CREATE TYPE "Role" AS ENUM ('ORGANIZER', 'PARTICIPANT');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("tokenHash")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "location" VARCHAR(200) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_capacity_positive" CHECK ("capacity" > 0)
);

CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX "events_organizerId_idx" ON "events"("organizerId");
CREATE INDEX "events_startsAt_id_idx" ON "events"("startsAt", "id");
CREATE UNIQUE INDEX "registrations_eventId_participantId_key" ON "registrations"("eventId", "participantId");
CREATE INDEX "registrations_participantId_registeredAt_id_idx" ON "registrations"("participantId", "registeredAt", "id");
CREATE INDEX "registrations_eventId_registeredAt_id_idx" ON "registrations"("eventId", "registeredAt", "id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
