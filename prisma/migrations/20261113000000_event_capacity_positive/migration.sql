ALTER TABLE "events"
ADD CONSTRAINT "events_capacity_positive_check" CHECK ("capacity" > 0);
