import { HttpStatus, Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from 'src/prisma.service';
import { RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';

@Injectable()
export class OrdersService {

  constructor(
    private prismaService: PrismaService,
    // @Inject(PRODUCT_SERVICE) private readonly productsClient: ClientProxy,
  ) {
    // super();
  }
  
  create(createOrderDto: CreateOrderDto) {
    return this.prismaService.order.create({
      data: createOrderDto
    })
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.prismaService.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;


    return {
      data: await this.prismaService.order.findMany({
        skip: ( currentPage - 1 ) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil( totalPages / perPage )
      }
    }
  }

  async findOne(id: string) {
    const order = await this.prismaService.order.findFirst({
      where: { id }
    });

    if ( !order ) {
      throw new RpcException({ 
        status: HttpStatus.NOT_FOUND, 
        message: `Order with id ${ id } not found`
      });
    }

    return order;
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);
    if ( order.status === status ) {
      return order;
    }

    return this.prismaService.order.update({
      where: { id },
      data: { status: status }
    });


  }
}
