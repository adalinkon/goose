pub mod doctor;
pub mod errors;
pub mod filesystem;
pub mod git;
pub mod provider_setup;

use axum::Router;

pub fn routes() -> Router {
    Router::new()
        .merge(doctor::routes())
        .merge(filesystem::routes())
        .merge(git::routes())
        .merge(provider_setup::routes())
}
