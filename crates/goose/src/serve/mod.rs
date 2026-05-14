pub mod doctor;
pub mod errors;
pub mod filesystem;
pub mod git;
pub mod personas;
pub mod provider_setup;

use axum::Router;

pub fn routes() -> Router {
    Router::new()
        .merge(doctor::routes())
        .merge(filesystem::routes())
        .merge(git::routes())
        .merge(personas::routes())
        .merge(provider_setup::routes())
}
