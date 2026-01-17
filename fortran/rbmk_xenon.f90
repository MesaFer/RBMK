! =============================================================================
! RBMK Xenon Module
! Xenon and Iodine poisoning dynamics
! =============================================================================

module rbmk_xenon
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Xenon dynamics calculation
    ! dI/dt = gamma_I * Sigma_f * phi - lambda_I * I
    ! dXe/dt = gamma_Xe * Sigma_f * phi + lambda_I * I - lambda_Xe * Xe - sigma_Xe * phi * Xe
    ! =========================================================================
    subroutine calculate_xenon_dynamics(iodine, xenon, neutron_flux, dt, &
                                        iodine_new, xenon_new) bind(C, name="calculate_xenon_dynamics")
        real(c_double), intent(in), value :: iodine          ! I-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: xenon           ! Xe-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: neutron_flux    ! Neutron flux [n/cm^2/s]
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: iodine_new            ! New I-135 concentration
        real(c_double), intent(out) :: xenon_new             ! New Xe-135 concentration
        
        real(c_double) :: fission_rate, dI_dt, dXe_dt
        
        ! Fission rate
        fission_rate = SIGMA_F * neutron_flux
        
        ! Iodine-135 production and decay
        dI_dt = GAMMA_I * fission_rate - LAMBDA_I * iodine
        
        ! Xenon-135 production (direct + from I-135 decay) and removal (decay + burnup)
        ! Note: SIGMA_XE is already in cm^2, no need for barn conversion
        dXe_dt = GAMMA_XE * fission_rate + LAMBDA_I * iodine - &
                 LAMBDA_XE * xenon - SIGMA_XE * neutron_flux * xenon
        
        ! Update concentrations (simple Euler)
        iodine_new = iodine + dI_dt * dt
        xenon_new = xenon + dXe_dt * dt
        
        ! Ensure non-negative and clamp to reasonable range
        iodine_new = max(min(iodine_new, 1.0d20), 0.0d0)
        xenon_new = max(min(xenon_new, 1.0d20), 0.0d0)
        
    end subroutine calculate_xenon_dynamics

    ! =========================================================================
    ! Calculate equilibrium xenon concentration for given power level
    ! =========================================================================
    subroutine calculate_equilibrium_xenon(power_fraction, eq_iodine, eq_xenon) &
               bind(C, name="calculate_equilibrium_xenon")
        real(c_double), intent(in), value :: power_fraction  ! Power as fraction of nominal (0-1)
        real(c_double), intent(out) :: eq_iodine             ! Equilibrium I-135 [atoms/cm^3]
        real(c_double), intent(out) :: eq_xenon              ! Equilibrium Xe-135 [atoms/cm^3]
        
        real(c_double) :: flux, fission_rate
        
        ! Estimate flux from power fraction
        flux = power_fraction * 1.0d14  ! Nominal flux ~1e14 n/cm^2/s
        fission_rate = SIGMA_F * flux
        
        ! Equilibrium I-135: dI/dt = 0 => I_eq = gamma_I * Sigma_f * phi / lambda_I
        eq_iodine = GAMMA_I * fission_rate / LAMBDA_I
        
        ! Equilibrium Xe-135: dXe/dt = 0
        ! Xe_eq = (gamma_Xe * Sigma_f * phi + lambda_I * I_eq) / (lambda_Xe + sigma_Xe * phi)
        ! Note: SIGMA_XE is already in cm^2, no need for barn conversion
        eq_xenon = (GAMMA_XE * fission_rate + LAMBDA_I * eq_iodine) / &
                   (LAMBDA_XE + SIGMA_XE * flux)
        
    end subroutine calculate_equilibrium_xenon

end module rbmk_xenon
