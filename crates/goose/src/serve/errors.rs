use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub message: String,
    #[serde(skip)]
    pub status: StatusCode,
}

impl ErrorResponse {
    pub fn internal(message: impl ToString) -> Self {
        Self {
            message: message.to_string(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn bad_request(message: impl ToString) -> Self {
        Self {
            message: message.to_string(),
            status: StatusCode::BAD_REQUEST,
        }
    }

    pub fn not_found(message: impl ToString) -> Self {
        Self {
            message: message.to_string(),
            status: StatusCode::NOT_FOUND,
        }
    }
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        (self.status, Json(self)).into_response()
    }
}
