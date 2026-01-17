! =============================================================================
! RBMK Xenon Module
! Xenon and Iodine poisoning dynamics
! =============================================================================

module rbmk_xenon
    use iso_c_binding
    use rbmk_constants
    implicit none
    
    ! Fission rate scaling factor
    ! At nominal power (3200 MW), fission rate is approximately:
    ! P = E_fission * fission_rate * V
    ! 3200 MW = 200 MeV/fission * 1.6e-13 J/MeV * fission_rate * V
    ! For RBMK core volume ~190 m³ = 1.9e8 cm³
    ! fission_rate_density = 3200e6 W / (3.2e-11 J/fission * 1.9e8 cm³) ≈ 5.3e11 fissions/(cm³·s)
    real(c_double), parameter :: NOMINAL_FISSION_RATE = 5.3d11  ! fissions/(cm³·s) at 100% power
    
contains

    ! =========================================================================
    ! Xenon dynamics calculation
    !
    ! Physical model:
    ! dI/dt = gamma_I * F - lambda_I * I
    ! dXe/dt = gamma_Xe * F + lambda_I * I - lambda_Xe * Xe - sigma_Xe * phi * Xe
    !
    ! where F is fission rate density [fissions/(cm³·s)]
    !
    ! At equilibrium for 100% power:
    ! - I_eq ≈ 2.5e15 atoms/cm³
    ! - Xe_eq ≈ 3.5e13 atoms/cm³ (limited by burnup at high flux)
    ! =========================================================================
    subroutine calculate_xenon_dynamics(iodine, xenon, neutron_flux, dt, &
                                        iodine_new, xenon_new) bind(C, name="calculate_xenon_dynamics")
        real(c_double), intent(in), value :: iodine          ! I-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: xenon           ! Xe-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: neutron_flux    ! Neutron flux [n/cm^2/s] (normalized: 1e14 at 100%)
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: iodine_new            ! New I-135 concentration
        real(c_double), intent(out) :: xenon_new             ! New Xe-135 concentration
        
        real(c_double) :: power_fraction, fission_rate_density, dI_dt, dXe_dt
        real(c_double) :: phi_normalized
        
        ! Calculate power fraction from neutron flux
        ! Nominal flux is 1e14 n/(cm²·s)
        phi_normalized = neutron_flux / 1.0d14
        power_fraction = max(phi_normalized, 0.0d0)
        
        ! Fission rate density proportional to power
        fission_rate_density = NOMINAL_FISSION_RATE * power_fraction
        
        ! Iodine-135 production and decay
        ! Production: gamma_I * F (6.1% of fissions produce I-135)
        ! Decay: lambda_I * I (half-life 6.57 hours)
        dI_dt = GAMMA_I * fission_rate_density - LAMBDA_I * iodine
        
        ! Xenon-135 production and removal
        ! Production: gamma_Xe * F (0.3% direct) + lambda_I * I (from iodine decay)
        ! Removal: lambda_Xe * Xe (decay, half-life 9.2 hours) + sigma_Xe * phi * Xe (burnup)
        dXe_dt = GAMMA_XE * fission_rate_density + LAMBDA_I * iodine - &
                 LAMBDA_XE * xenon - SIGMA_XE * neutron_flux * xenon
        
        ! Update concentrations (simple Euler)
        iodine_new = iodine + dI_dt * dt
        xenon_new = xenon + dXe_dt * dt
        
        ! Ensure non-negative and clamp to reasonable range
        ! Maximum realistic values: I ~ 1e16, Xe ~ 1e15 atoms/cm³
        iodine_new = max(min(iodine_new, 1.0d17), 0.0d0)
        xenon_new = max(min(xenon_new, 1.0d16), 0.0d0)
        
    end subroutine calculate_xenon_dynamics

    ! =========================================================================
    ! Calculate equilibrium xenon concentration for given power level
    !
    ! At equilibrium:
    ! - I_eq = γ_I * F / λ_I
    ! - Xe_eq = (γ_Xe * F + λ_I * I_eq) / (λ_Xe + σ_Xe * φ)
    !
    ! For 100% power:
    ! - F = 5.3e11 fissions/(cm³·s)
    ! - φ = 1e14 n/(cm²·s)
    ! - I_eq ≈ 1.1e15 atoms/cm³
    ! - Xe_eq ≈ 3.5e13 atoms/cm³
    ! =========================================================================
    subroutine calculate_equilibrium_xenon(power_fraction, eq_iodine, eq_xenon) &
               bind(C, name="calculate_equilibrium_xenon")
        real(c_double), intent(in), value :: power_fraction  ! Power as fraction of nominal (0-1)
        real(c_double), intent(out) :: eq_iodine             ! Equilibrium I-135 [atoms/cm^3]
        real(c_double), intent(out) :: eq_xenon              ! Equilibrium Xe-135 [atoms/cm^3]
        
        real(c_double) :: flux, fission_rate_density
        
        ! Neutron flux proportional to power
        flux = power_fraction * 1.0d14  ! Nominal flux ~1e14 n/cm²/s
        
        ! Fission rate density proportional to power
        fission_rate_density = NOMINAL_FISSION_RATE * power_fraction
        
        ! Equilibrium I-135: dI/dt = 0 => I_eq = γ_I * F / λ_I
        eq_iodine = GAMMA_I * fission_rate_density / LAMBDA_I
        
        ! Equilibrium Xe-135: dXe/dt = 0
        ! Xe_eq = (γ_Xe * F + λ_I * I_eq) / (λ_Xe + σ_Xe * φ)
        eq_xenon = (GAMMA_XE * fission_rate_density + LAMBDA_I * eq_iodine) / &
                   (LAMBDA_XE + SIGMA_XE * flux)
        
    end subroutine calculate_equilibrium_xenon

end module rbmk_xenon
