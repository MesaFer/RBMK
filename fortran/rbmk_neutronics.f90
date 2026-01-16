! =============================================================================
! RBMK Neutronics Module
! Neutron flux distribution calculations
! =============================================================================

module rbmk_neutronics
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Calculate neutron flux using one-group diffusion equation
    ! Solves: D*nabla^2(phi) - Sigma_a*phi + nu*Sigma_f*phi = 0
    ! Using finite difference method for 1D axial distribution
    ! =========================================================================
    subroutine calculate_neutron_flux(n_points, dz, flux, k_eff) bind(C, name="calculate_neutron_flux")
        integer(c_int), intent(in), value :: n_points
        real(c_double), intent(in), value :: dz
        real(c_double), intent(inout) :: flux(n_points)
        real(c_double), intent(out) :: k_eff
        
        real(c_double) :: flux_new(n_points)
        real(c_double) :: source, leakage
        real(c_double) :: total_fission, total_absorption
        integer :: i, iter
        integer, parameter :: MAX_ITER = 1000
        real(c_double), parameter :: TOLERANCE = 1.0d-6
        real(c_double), parameter :: PI = 3.14159265358979323846d0
        real(c_double) :: k_old, diff, flux_sum
        
        ! Initialize with cosine distribution (fundamental mode)
        do i = 1, n_points
            flux(i) = cos(PI * (dble(i) - dble(n_points)/2.0d0) / dble(n_points))
            if (flux(i) < 0.0d0) flux(i) = 0.0d0
        end do
        
        ! Normalize initial flux
        flux_sum = sum(flux)
        if (flux_sum > 0.0d0) then
            flux = flux / flux_sum
        end if
        k_eff = 1.0d0
        
        ! Power iteration method
        do iter = 1, MAX_ITER
            k_old = k_eff
            total_fission = 0.0d0
            total_absorption = 0.0d0
            
            ! Calculate new flux distribution
            do i = 2, n_points - 1
                ! Diffusion term (second derivative)
                leakage = D_COEFF * (flux(i+1) - 2.0d0*flux(i) + flux(i-1)) / (dz * dz)
                
                ! Source term (fission)
                source = NU_SIGMA_F * flux(i) / k_eff
                
                ! New flux from balance equation
                flux_new(i) = (source + leakage / SIGMA_A)
                if (flux_new(i) < 0.0d0) flux_new(i) = 0.0d0
                
                total_fission = total_fission + NU_SIGMA_F * flux(i)
                total_absorption = total_absorption + SIGMA_A * flux(i)
            end do
            
            ! Boundary conditions (zero flux at extrapolated boundary)
            flux_new(1) = 0.0d0
            flux_new(n_points) = 0.0d0
            
            ! Update k_eff
            if (total_absorption > 0.0d0) then
                k_eff = total_fission / total_absorption
            end if
            
            ! Normalize and update flux
            flux_sum = sum(flux_new)
            if (flux_sum > 0.0d0) then
                flux = flux_new / flux_sum
            end if
            
            ! Check convergence
            diff = abs(k_eff - k_old)
            if (diff < TOLERANCE) exit
        end do
        
    end subroutine calculate_neutron_flux

    ! =========================================================================
    ! Update axial flux distribution based on neutron population
    ! Uses parabolic approximation for simplicity
    ! =========================================================================
    subroutine update_axial_flux(n_points, neutron_population, axial_flux) &
               bind(C, name="update_axial_flux")
        integer(c_int), intent(in), value :: n_points
        real(c_double), intent(in), value :: neutron_population
        real(c_double), intent(out) :: axial_flux(n_points)
        
        integer :: i
        real(c_double) :: z, center
        
        center = dble(n_points) / 2.0d0
        
        do i = 1, n_points
            z = (dble(i) - center) / center  ! -1 to 1
            axial_flux(i) = neutron_population * max(1.0d0 - z * z, 0.0d0)
        end do
        
    end subroutine update_axial_flux

end module rbmk_neutronics
