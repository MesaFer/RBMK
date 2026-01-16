//! RBMK Reactor Simulator Library
//! 
//! This library provides nuclear physics simulation for RBMK-1000 reactor
//! using Fortran for core calculations and Rust for application logic.

pub mod fortran_ffi;
pub mod reactor;
pub mod commands;

pub use reactor::{ReactorSimulator, ReactorState};
pub use commands::SimulatorState;
