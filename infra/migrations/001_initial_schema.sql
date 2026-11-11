-- ====================================================================
-- NEUROLAB ENTERPRISE - ESQUEMA INICIAL DE REFERENCIA (PostgreSQL 16+)
-- Generado desde services/api/alembic (revision f25503c0985b).
-- Fuente de verdad: alembic upgrade head. Este archivo es solo referencia.
-- ====================================================================

BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> f25503c0985b

CREATE TABLE users (
    id UUID NOT NULL, 
    email VARCHAR(255) NOT NULL, 
    password_hash VARCHAR(255) NOT NULL, 
    display_name VARCHAR(150) NOT NULL, 
    role VARCHAR(50) NOT NULL, 
    status VARCHAR(50) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE projects (
    id UUID NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    description TEXT, 
    owner_id UUID NOT NULL, 
    status VARCHAR(50) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_owner ON projects (owner_id);

CREATE TABLE architectures (
    id UUID NOT NULL, 
    project_id UUID NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    family VARCHAR(50) NOT NULL, 
    config_json JSONB NOT NULL, 
    version INTEGER NOT NULL, 
    created_by UUID, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX idx_architectures_project ON architectures (project_id);

CREATE TABLE audit_events (
    id UUID NOT NULL, 
    actor_id UUID, 
    project_id UUID, 
    action VARCHAR(100) NOT NULL, 
    metadata_json JSONB NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(actor_id) REFERENCES users (id) ON DELETE SET NULL, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_events_actor ON audit_events (actor_id);

CREATE INDEX idx_audit_events_project ON audit_events (project_id);

CREATE TABLE datasets (
    id UUID NOT NULL, 
    project_id UUID NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    version VARCHAR(50) NOT NULL, 
    storage_key VARCHAR(500) NOT NULL, 
    original_filename VARCHAR(255) NOT NULL, 
    size_bytes INTEGER NOT NULL, 
    checksum VARCHAR(128) NOT NULL, 
    target_column VARCHAR(150), 
    verified BOOLEAN NOT NULL, 
    metadata_json JSONB NOT NULL, 
    created_by UUID, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX idx_datasets_project ON datasets (project_id);

CREATE TABLE project_members (
    project_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    role VARCHAR(50) NOT NULL, 
    added_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (project_id, user_id), 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE training_jobs (
    id UUID NOT NULL, 
    project_id UUID NOT NULL, 
    architecture_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    status VARCHAR(50) NOT NULL, 
    progress FLOAT NOT NULL, 
    hyperparameters JSONB NOT NULL, 
    cancel_requested BOOLEAN NOT NULL, 
    requested_by UUID, 
    started_at TIMESTAMP WITH TIME ZONE, 
    ended_at TIMESTAMP WITH TIME ZONE, 
    error_message TEXT, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(architecture_id) REFERENCES architectures (id) ON DELETE RESTRICT, 
    FOREIGN KEY(dataset_id) REFERENCES datasets (id) ON DELETE RESTRICT, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(requested_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_training_jobs_project ON training_jobs (project_id);

CREATE INDEX idx_training_jobs_status ON training_jobs (status);

CREATE TABLE model_versions (
    id UUID NOT NULL, 
    project_id UUID NOT NULL, 
    job_id UUID NOT NULL, 
    version VARCHAR(50) NOT NULL, 
    storage_key VARCHAR(500) NOT NULL, 
    status VARCHAR(50) NOT NULL, 
    checksum VARCHAR(128) NOT NULL, 
    metrics_summary JSONB, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(job_id) REFERENCES training_jobs (id) ON DELETE RESTRICT, 
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX idx_model_versions_project ON model_versions (project_id);

CREATE TABLE training_metrics (
    id SERIAL NOT NULL, 
    job_id UUID NOT NULL, 
    epoch INTEGER NOT NULL, 
    metric_name VARCHAR(100) NOT NULL, 
    metric_value FLOAT NOT NULL, 
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(job_id) REFERENCES training_jobs (id) ON DELETE CASCADE, 
    CONSTRAINT uq_metric_job_epoch_name UNIQUE (job_id, epoch, metric_name)
);

CREATE INDEX idx_metrics_job_epoch ON training_metrics (job_id, epoch);

INSERT INTO alembic_version (version_num) VALUES ('f25503c0985b') RETURNING alembic_version.version_num;

COMMIT;

