# Use the official PostgreSQL 18 Alpine image for a lightweight container
FROM postgres:18-alpine

# Set default credentials and database name (aligned with the application's .env file)
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=postgres
ENV POSTGRES_DB=template1

# Document that the container listens on the standard PostgreSQL port
EXPOSE 5432
