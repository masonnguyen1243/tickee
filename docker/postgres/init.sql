-- Chạy một lần khi volume Postgres còn trống (docker-entrypoint-initdb.d), và trong CI qua psql.
-- Mật khẩu chỉ dùng cho local/CI; môi trường thật tiêm từ secret store.
CREATE ROLE tickee_migrator LOGIN PASSWORD 'tickee_migrator';
CREATE ROLE tickee_app LOGIN PASSWORD 'tickee_app';

-- tickee_migrator sở hữu DB nên có quyền DDL (CREATE SCHEMA, CREATE trên public).
CREATE DATABASE tickee OWNER tickee_migrator;
CREATE DATABASE tickee_test OWNER tickee_migrator;

\connect tickee
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE tickee FROM PUBLIC;
GRANT CONNECT ON DATABASE tickee TO tickee_app;

\connect tickee_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE tickee_test FROM PUBLIC;
GRANT CONNECT ON DATABASE tickee_test TO tickee_app;
