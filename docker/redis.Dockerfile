# Use the official Redis Alpine image for a lightweight container
FROM redis:alpine

# Set default credentials
ENV REDIS_USER=default
ENV REDIS_PASSWORD=mypassword

# Create ACL file dynamically at runtime based on environment variables and start Redis.
# If REDIS_USER is 'default', it enables password authentication for the default user.
# If REDIS_USER is anything else, it enables that user and disables the passwordless default user.
CMD sh -c "mkdir -p /usr/local/etc/redis && \
           echo \"user \${REDIS_USER} on >\${REDIS_PASSWORD} ~* &* +@all\" > /usr/local/etc/redis/users.acl && \
           if [ \"\${REDIS_USER}\" != \"default\" ]; then \
             echo 'user default off' >> /usr/local/etc/redis/users.acl; \
           fi && \
           exec redis-server --aclfile /usr/local/etc/redis/users.acl"

# Document that the container listens on the standard Redis port
EXPOSE 6379
