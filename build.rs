use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Tauri build
    tauri_build::build();
    
    // Get the output directory
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    
    // Compile Fortran code to object file
    // Requires gfortran to be installed (part of MinGW-w64 on Windows)
    let fortran_src = "fortran/rbmk_physics.f90";
    let fortran_obj = out_dir.join("rbmk_physics.o");
    
    println!("cargo:rerun-if-changed={}", fortran_src);
    
    // Compile Fortran to object file
    let status = Command::new("gfortran")
        .args(&[
            "-c",                           // Compile only
            "-O3",                          // Optimization level 3
            "-fPIC",                        // Position independent code
            "-ffree-form",                  // Free-form Fortran
            "-o", fortran_obj.to_str().unwrap(),
            fortran_src,
        ])
        .status()
        .expect("Failed to compile Fortran code. Make sure gfortran is installed.");
    
    if !status.success() {
        panic!("Fortran compilation failed!");
    }
    
    // Create static library from object file
    let lib_path = out_dir.join("librbmk_physics.a");
    
    let status = Command::new("ar")
        .args(&[
            "rcs",
            lib_path.to_str().unwrap(),
            fortran_obj.to_str().unwrap(),
        ])
        .status()
        .expect("Failed to create static library. Make sure ar is installed.");
    
    if !status.success() {
        panic!("Static library creation failed!");
    }
    
    // Tell cargo to link the library
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=rbmk_physics");
    
    // Link Fortran runtime libraries (gfortran runtime)
    println!("cargo:rustc-link-lib=dylib=gfortran");
    
    // On Windows, we might need additional libraries
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-lib=dylib=quadmath");
    }
}
